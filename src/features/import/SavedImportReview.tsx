import { useCallback, useEffect, useRef, useState } from 'react'
import { DataTable, Drawer, EmptyState, StatusBadge } from '../../components/ui'
import type { ImportPersistence, SavedImportBatch, SavedImportIssue, SavedRawImportRow } from '../../services/importPersistence'

const count = (value: number) => value.toLocaleString('ko-KR')
const source = (sheet: string, row: number | null) => `${sheet} / ${row === null ? '전체' : `${row}행`}`
const observed = (value: unknown) => value === null || value === undefined || value === '' ? '—' : Array.isArray(value) ? value.join(', ') : String(value)

function SavedRawDetail({ issue, rawRow, loading, error, onClose }: {
  issue: SavedImportIssue
  rawRow: SavedRawImportRow | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  return <Drawer title={issue.issueCode} subtitle={source(issue.sourceSheet ?? '전체', issue.sourceRow)} onClose={onClose}>
    <dl className="import-issue-detail">
      <dt>차단 범위</dt><dd>{issue.blockingScope}</dd>
      <dt>원본 값</dt><dd>{observed(issue.observedValue)}</dd>
      <dt>기대 규칙</dt><dd>{issue.expectedRule}</dd>
      <dt>설명</dt><dd>{issue.message}</dd>
      <dt>상태</dt><dd>{issue.status}</dd>
      <dt>관련 원본 행</dt><dd>{issue.relatedRawRowIds.length ? `${count(issue.relatedRawRowIds.length)}건` : '—'}</dd>
    </dl>
    <h3 className="import-detail-heading">저장된 원본 행</h3>
    {loading && <p className="muted" role="status">원본 행을 불러오는 중입니다…</p>}
    {error && <p className="import-error" role="alert">{error}</p>}
    {!loading && !error && !issue.rawImportRowId && <p className="muted">이 이슈는 파일 구조 전체에 관한 것으로 연결된 원본 행이 없습니다.</p>}
    {!loading && rawRow && <>
      <p className="import-raw-source">{rawRow.sourceSheet} / {rawRow.originalRowNumber}행 · {rawRow.sourceBlock ?? '구분 없음'}</p>
      <dl className="import-raw-cells">{rawRow.rawCells.map(cell => <div key={cell.address}><dt>{cell.address} · {cell.originalType}</dt><dd>{String(cell.originalValue ?? cell.cachedValue ?? '빈 값')}{cell.formulaText && <small>수식: {cell.formulaText}</small>}{cell.errorCode && <small>오류: {cell.errorCode}</small>}</dd></div>)}</dl>
    </>}
  </Drawer>
}

export function SavedImportReview({ persistence, refreshKey }: {
  persistence: ImportPersistence
  refreshKey: number
}) {
  const batchRequest = useRef(0)
  const rawRequest = useRef(0)
  const [batches, setBatches] = useState<readonly SavedImportBatch[]>([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<SavedImportBatch | null>(null)
  const [issues, setIssues] = useState<readonly SavedImportIssue[]>([])
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<SavedImportIssue | null>(null)
  const [rawRow, setRawRow] = useState<SavedRawImportRow | null>(null)
  const [loadingRaw, setLoadingRaw] = useState(false)
  const [rawError, setRawError] = useState<string | null>(null)

  const openBatch = useCallback(async (batch: SavedImportBatch) => {
    const currentRequest = ++batchRequest.current
    setSelectedBatch(batch); setIssues([]); setIssueError(null); setLoadingIssues(true)
    try {
      const next = await persistence.loadSavedImportIssues(batch.id)
      if (currentRequest === batchRequest.current) setIssues(next)
    } catch {
      if (currentRequest === batchRequest.current) setIssueError('저장된 검증 이슈를 불러오지 못했습니다.')
    } finally {
      if (currentRequest === batchRequest.current) setLoadingIssues(false)
    }
  }, [persistence])

  const openIssue = async (issue: SavedImportIssue) => {
    const currentRequest = ++rawRequest.current
    setSelectedIssue(issue); setRawRow(null); setRawError(null)
    if (!issue.rawImportRowId) { setLoadingRaw(false); return }
    setLoadingRaw(true)
    try {
      const next = await persistence.loadRawImportRow(issue.rawImportRowId)
      if (currentRequest === rawRequest.current) setRawRow(next)
    } catch {
      if (currentRequest === rawRequest.current) setRawError('연결된 원본 행을 불러오지 못했습니다.')
    } finally {
      if (currentRequest === rawRequest.current) setLoadingRaw(false)
    }
  }

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (!active) return null
      setLoadingBatches(true)
      setHistoryError(null)
      return persistence.listSavedMasterImports()
    }).then(next => {
      if (next === null) return
      if (!active) return
      setBatches(next)
    }).catch(() => {
      if (active) setHistoryError('최근 저장된 Master 검증을 불러오지 못했습니다.')
    }).finally(() => { if (active) setLoadingBatches(false) })
    return () => { active = false }
  }, [persistence, refreshKey])

  return <section className="panel import-saved" aria-label="최근 저장된 Master 검증">
    <div className="section-heading"><div><h2>최근 저장된 Master 검증</h2><p>현재 워크스페이스에 저장된 최근 20개 Dry-run 결과입니다.</p></div><span className="subtle-tag">SHARED REVIEW</span></div>
    {loadingBatches && <p className="import-section-state" role="status">저장 이력을 불러오는 중입니다…</p>}
    {historyError && <p className="import-error import-section-state" role="alert">{historyError}</p>}
    {!loadingBatches && !historyError && !batches.length && <EmptyState title="저장된 검증 결과가 없습니다" description="Master Excel을 분석한 뒤 검증 결과를 저장하면 여기에 표시됩니다." />}
    {!loadingBatches && !historyError && batches.length > 0 && <DataTable minWidth={980}><thead><tr><th>저장 시각</th><th>파일명</th><th>상태</th><th>원본 행</th><th>Product / SKU / BOM</th><th>정상</th><th>주의</th><th>오류</th><th>보류</th><th>저장자</th><th>상세</th></tr></thead><tbody>{batches.map(batch => <tr key={batch.id}><td>{new Date(batch.createdAt).toLocaleString('ko-KR')}</td><td>{batch.sourceFilename}</td><td><StatusBadge status={batch.status} /></td><td>{count(batch.rowCount)}</td><td>{count(batch.productCount)} / {count(batch.skuCount)} / {count(batch.bomCount)}</td><td>{count(batch.validCount)}</td><td>{count(batch.warningCount)}</td><td>{count(batch.errorCount)}</td><td>{count(batch.deferredCount)}</td><td>{batch.createdBy ? '기록됨' : '—'}</td><td><button className="button button-small" type="button" aria-label={`${batch.sourceFilename} 배치 상세 보기`} onClick={() => void openBatch(batch)}>상세</button></td></tr>)}</tbody></DataTable>}

    {selectedBatch && <section className="import-saved-detail" aria-label="저장된 Batch 상세">
      <div className="section-heading"><div><h3>저장된 Batch 상세</h3><p className="mono">Batch ID: {selectedBatch.id}</p></div><StatusBadge status={selectedBatch.status} /></div>
      <dl className="import-batch-meta"><div><dt>파일명</dt><dd>{selectedBatch.sourceFilename}</dd></div><div><dt>저장 시각</dt><dd>{new Date(selectedBatch.createdAt).toLocaleString('ko-KR')}</dd></div><div><dt>원본 행</dt><dd>{count(selectedBatch.rowCount)}</dd></div><div><dt>후보 요약</dt><dd>Product {count(selectedBatch.productCount)} · SKU {count(selectedBatch.skuCount)} · BOM {count(selectedBatch.bomCount)}</dd></div></dl>
      <div className="import-saved-summary" aria-label="저장된 후보 판정 요약"><div><span>정상</span><strong>{count(selectedBatch.validCount)}</strong></div><div><span>주의</span><strong>{count(selectedBatch.warningCount)}</strong></div><div><span>오류</span><strong>{count(selectedBatch.errorCount)}</strong></div><div><span>보류</span><strong>{count(selectedBatch.deferredCount)}</strong></div></div>
      <p className="import-limitation">Product/SKU/BOM Candidate 전체 Snapshot은 현재 브라우저 Dry-run 세션에서만 제공됩니다. 저장된 결과는 원본 증거와 검증 이슈를 공유하기 위한 기록이며 Master Apply가 아닙니다.</p>
      <div className="section-heading import-saved-issues-heading"><div><h3>저장된 검증 이슈</h3><p>이슈 상세에서 연결된 원본 행을 필요한 시점에만 조회합니다.</p></div></div>
      {loadingIssues && <p className="import-section-state" role="status">검증 이슈를 불러오는 중입니다…</p>}
      {issueError && <p className="import-error import-section-state" role="alert">{issueError}</p>}
      {!loadingIssues && !issueError && !issues.length && <EmptyState title="저장된 검증 이슈가 없습니다" />}
      {!loadingIssues && !issueError && issues.length > 0 && <DataTable minWidth={900}><thead><tr><th>심각도</th><th>코드</th><th>시트 / 행</th><th>필드</th><th>원본 값</th><th>메시지</th><th>원본</th></tr></thead><tbody>{issues.map(issue => <tr key={issue.id}><td><StatusBadge status={issue.severity} /></td><td className="mono">{issue.issueCode}</td><td>{source(issue.sourceSheet ?? '전체', issue.sourceRow)}</td><td>{issue.fieldPath ?? '—'}</td><td className="import-observed">{observed(issue.observedValue)}</td><td>{issue.message}</td><td><button className="button button-small" type="button" aria-label={`${issue.issueCode} 원본 상세`} onClick={() => void openIssue(issue)}>원본 상세</button></td></tr>)}</tbody></DataTable>}
    </section>}

    {selectedIssue && <SavedRawDetail issue={selectedIssue} rawRow={rawRow} loading={loadingRaw} error={rawError} onClose={() => { ++rawRequest.current; setSelectedIssue(null); setRawRow(null); setRawError(null) }} />}
  </section>
}
