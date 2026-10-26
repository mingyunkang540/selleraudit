import { useMemo, useRef, useState } from 'react'
import { DataTable, Drawer, EmptyState, PageHeader, SearchInput, StatusBadge } from '../../components/ui'
import type { ImportPersistence } from '../../services/importPersistence'
import type { MasterImportPreview } from '../../types/import'
import { SavedImportReview } from './SavedImportReview'
import './master-import.css'

type ProcessingState = 'IDLE' | 'READING' | 'VALIDATING' | 'READY' | 'ERROR'
type CandidateTab = 'products' | 'skus' | 'bomComponents'
type ImportIssue = MasterImportPreview['issues'][number]

const PAGE_SIZE = 25
const count = (value: number) => value.toLocaleString('ko-KR')
const source = (sheet: string, row: number | null) => `${sheet} / ${row === null ? '전체' : `${row}행`}`
const statusLabel: Record<string, string> = { VALID: '정상', WARNING: '주의', ERROR: '오류', DEFERRED: '보류' }

function Status({ value }: { value: string }) {
  return <StatusBadge status={value} label={statusLabel[value] ?? value} />
}

function Summary({ preview }: { preview: MasterImportPreview }) {
  const { summary } = preview
  return <section className="panel import-summary" aria-label="Dry-run 요약">
    <div className="section-heading"><div><h2>Master 분석 결과</h2><p>원본에서 추출한 후보와 검증 결과입니다. 실제 데이터는 변경되지 않았습니다.</p></div><span className="subtle-tag">DRY-RUN ONLY</span></div>
    <div className="import-summary-grid">
      {[
        ['원본 행', summary.rowCount], ['Product 후보', summary.productCount], ['SKU 후보', summary.skuCount],
        ['BOM 구성 후보', summary.bomCount], ['정상 후보', summary.validCount], ['주의 후보', summary.warningCount],
        ['오류 후보', summary.errorCount], ['보류 후보', summary.deferredCount],
      ].map(([label, value]) => <div className="import-metric" key={label}><span>{label}</span><strong>{count(Number(value))}</strong></div>)}
    </div>
  </section>
}

function RelatedCandidates({ preview, issue }: { preview: MasterImportPreview; issue: ImportIssue }) {
  const rows = new Set(issue.relatedRows)
  if (issue.sourceRow !== null) rows.add(issue.sourceRow)
  const products = preview.products.filter(item => issue.sourceSheet === item.sourceSheet && rows.has(item.sourceRow))
  const skus = preview.skus.filter(item => issue.sourceSheet === item.sourceSheet && rows.has(item.sourceRow))
  const components = preview.bomComponents.filter(item => issue.sourceSheet === item.sourceSheet && rows.has(item.sourceRow))
  const candidates = [
    ...products.map(item => ({ id: item.id, label: `Product ${item.sabangnetCode ?? '미입력'} · ${item.productName ?? '상품명 없음'}`, status: item.status })),
    ...skus.map(item => ({ id: item.id, label: `SKU ${item.skuCode} · ${item.modelName}`, status: item.status })),
    ...components.map(item => ({ id: item.id, label: `BOM ${item.skuCode} × ${item.quantity ?? '미입력'}`, status: item.status })),
  ]
  return <><h3 className="import-detail-heading">관련 Product / SKU / BOM 후보</h3>{candidates.length ? <ul className="import-related-candidates">{candidates.map(item => <li key={item.id}><span>{item.label}</span><Status value={item.status} /></li>)}</ul> : <p className="muted">연결된 후보가 없습니다.</p>}</>
}

export function MasterImport({ persistence, role = 'ADMIN' }: { persistence?: ImportPersistence; role?: 'ADMIN' | 'EDITOR' }) {
  const requestId = useRef(0)
  const savingPreviewId = useRef<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<ProcessingState>('IDLE')
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<MasterImportPreview | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [issueFilter, setIssueFilter] = useState<'ALL' | 'ERROR' | 'WARNING'>('ALL')
  const [issuePage, setIssuePage] = useState(1)
  const [selectedIssue, setSelectedIssue] = useState<ImportIssue | null>(null)
  const [tab, setTab] = useState<CandidateTab>('products')
  const [candidatePage, setCandidatePage] = useState(1)
  const [saveState, setSaveState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'>('IDLE')
  const [savedBatchId, setSavedBatchId] = useState<string | null>(null)
  const [historyRefresh, setHistoryRefresh] = useState(0)

  const chooseFile = (next: File | null) => {
    requestId.current += 1
    setFile(next); setPreview(null); setHash(null); setMessage(null); setState('IDLE')
    setQuery(''); setIssuePage(1); setCandidatePage(1); setSelectedIssue(null)
    setSaveState('IDLE'); setSavedBatchId(null)
    if (next && !/\.xlsx$/i.test(next.name)) { setState('ERROR'); setMessage('.xlsx 형식의 Master Excel 파일을 선택해 주세요.') }
  }

  const analyze = async () => {
    if (!file || state === 'READING' || state === 'VALIDATING') return
    if (!/\.xlsx$/i.test(file.name)) { setState('ERROR'); setMessage('.xlsx 형식의 Master Excel 파일을 선택해 주세요.'); return }
    const currentRequest = ++requestId.current
    setState('READING'); setMessage(null); setPreview(null); setHash(null); setSaveState('IDLE'); setSavedBatchId(null)
    try {
      const bytes = await file.arrayBuffer()
      if (currentRequest !== requestId.current) return
      setState('VALIDATING')
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      const { analyzeMasterWorkbook } = await import('../../services/import')
      const result = await analyzeMasterWorkbook(bytes, file.name)
      if (currentRequest !== requestId.current) return
      if (globalThis.crypto?.subtle) {
        try {
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          if (currentRequest !== requestId.current) return
          setHash(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''))
        } catch {
          // Keep the browser preview when hashing fails; shared persistence remains unavailable.
        }
      }
      if (currentRequest !== requestId.current) return
      setPreview(result)
      setState('READY')
    } catch {
      if (currentRequest !== requestId.current) return
      setMessage('파일을 분석하지 못했습니다. 파일이 손상되었거나 지원하지 않는 Excel 형식일 수 있습니다.')
      setState('ERROR')
    }
  }

  const savePreview = async () => {
    const currentPreviewId = requestId.current
    if (!persistence || !preview || !hash || saveState === 'SAVING' || saveState === 'SAVED' || savingPreviewId.current === currentPreviewId) return
    savingPreviewId.current = currentPreviewId
    setSaveState('SAVING'); setMessage(null)
    try {
      const batchId = await persistence.saveMasterDryRun(preview, hash)
      setHistoryRefresh(value => value + 1)
      if (currentPreviewId !== requestId.current) return
      setSavedBatchId(batchId)
      setSaveState('SAVED')
    } catch {
      if (currentPreviewId === requestId.current) setSaveState('ERROR')
    } finally {
      if (savingPreviewId.current === currentPreviewId) savingPreviewId.current = null
    }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredIssues = useMemo(() => preview?.issues.filter(issue =>
    (issueFilter === 'ALL' || issue.severity === issueFilter) &&
    (!normalizedQuery || [issue.code, issue.message, issue.observedValue, issue.sourceSheet, ...issue.relatedRows.map(String)].some(value => String(value ?? '').toLocaleLowerCase().includes(normalizedQuery))),
  ) ?? [], [preview, issueFilter, normalizedQuery])
  const visibleIssues = filteredIssues.slice((issuePage - 1) * PAGE_SIZE, issuePage * PAGE_SIZE)

  const filteredCandidates = useMemo(() => {
    if (!preview) return []
    const items = preview[tab]
    if (!normalizedQuery) return items
    return items.filter(item => Object.values(item).some(value =>
      (typeof value === 'string' || typeof value === 'number') && String(value).toLocaleLowerCase().includes(normalizedQuery)))
  }, [preview, tab, normalizedQuery])
  const visibleCandidates = filteredCandidates.slice((candidatePage - 1) * PAGE_SIZE, candidatePage * PAGE_SIZE)

  const rawRow = selectedIssue?.sourceRow !== null && selectedIssue && preview?.rawRows.find(row => row.sourceSheet === selectedIssue.sourceSheet && row.originalRowNumber === selectedIssue.sourceRow)

  return <div className="feature-page master-import-page">
    <PageHeader eyebrow="MASTER IMPORT · DRY-RUN" title="Master Excel 분석" description="상품·SKU·BOM 후보를 원본 파일에서 읽어 검증합니다. 분석 결과는 이 화면에만 남으며 Master에는 반영되지 않습니다." />
    <section className="panel import-upload" aria-label="Master Excel 선택">
      <div><h2>Master Excel 파일을 선택하세요</h2><p>땡스소윤 상품 단가표 형식의 .xlsx 파일을 지원합니다. 파일은 브라우저에서만 분석합니다.</p></div>
      <div className="import-upload-actions"><label className="button import-picker">파일 선택<input aria-label="Master Excel 파일" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => chooseFile(event.target.files?.[0] ?? null)} /></label><button className="button button-primary" type="button" onClick={() => void analyze()} disabled={!file || state === 'READING' || state === 'VALIDATING' || (state === 'ERROR' && !/\.xlsx$/i.test(file?.name ?? ''))}>분석 시작</button></div>
      {file && <dl className="import-file-meta"><div><dt>파일명</dt><dd>{file.name}</dd></div><div><dt>크기</dt><dd>{(file.size / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} KB</dd></div>{hash && <div><dt>SHA-256</dt><dd className="mono">{hash}</dd></div>}</dl>}
      {(state === 'READING' || state === 'VALIDATING') && <p role="status" className="import-progress">{state === 'READING' ? '파일을 읽는 중입니다…' : '원본 구조와 후보를 검증하는 중입니다…'}</p>}
      {message && <p role="alert" className="import-error">{message}</p>}
    </section>

    {preview && <>
      <Summary preview={preview} />
      <section className="panel import-persistence" aria-label="검증 결과 중앙 저장">
        <div><h2>검증 결과 공유 저장</h2><p>원본 행과 검증 이슈, 요약만 중앙 저장소에 기록합니다. 저장 성공은 Master Apply 가능 상태를 의미하지 않습니다.</p></div>
        {persistence ? <div className="import-persistence-actions"><button className="button button-primary" type="button" onClick={() => void savePreview()} disabled={!hash || saveState === 'SAVING' || saveState === 'SAVED'}>{saveState === 'SAVING' ? '저장 중…' : saveState === 'SAVED' ? '저장 완료' : '검증 결과 저장'}</button>{!hash && <span className="muted">SHA-256을 계산하지 못해 중앙 저장할 수 없습니다. 파일을 다시 분석해 주세요.</span>}</div> : <p className="muted">Supabase 모드에서만 공유 저장할 수 있습니다.</p>}
        {saveState === 'SAVED' && savedBatchId && <div className="import-save-success" role="status"><strong>검증 결과가 중앙 저장소에 저장되었습니다.</strong><span className="mono">Batch ID: {savedBatchId}</span><span>상태: REVIEW_REQUIRED</span><small>이 기록은 공유 검토용이며 Master Apply가 아닙니다.</small></div>}
        {saveState === 'ERROR' && <div className="import-error" role="alert"><strong>검증 결과를 저장하지 못했습니다.</strong><span>기존 Master 데이터는 변경되지 않았습니다.</span><button className="button button-small" type="button" onClick={() => setSaveState('IDLE')}>다시 시도</button></div>}
      </section>
      {preview.blocked && <div className="import-blocked" role="status"><strong>차단 오류 {count(preview.summary.blockingCount)}건을 확인하세요.</strong><span>현재 파일은 Master 적용 기준을 충족하지 않습니다. 이 화면에는 Apply 기능이 없습니다.</span></div>}
      {!preview.workbook.schemaValid && <div className="import-blocked" role="status">지원하는 Master Workbook 구조와 다릅니다. 아래 구조 오류를 확인하세요.</div>}
      <div className="import-filter-bar"><SearchInput value={query} onChange={value => { setQuery(value); setIssuePage(1); setCandidatePage(1) }} label="Import 후보 검색" placeholder="품번, 상품명, SKU, 오류 코드 검색" /><span>원본 시트: {preview.workbook.sheetNames.join(', ')}</span></div>
      <section className="panel" aria-label="검증 이슈"><div className="section-heading"><div><h2>검증 이슈</h2><p>원본 위치와 차단 사유를 확인할 수 있습니다.</p></div><div className="import-issue-filters" aria-label="이슈 필터">{(['ALL', 'ERROR', 'WARNING'] as const).map(value => <button key={value} type="button" className={`button button-small ${issueFilter === value ? 'import-selected' : ''}`} aria-pressed={issueFilter === value} onClick={() => { setIssueFilter(value); setIssuePage(1) }}>{value === 'ALL' ? '전체' : value === 'ERROR' ? '오류' : '주의'}</button>)}</div></div>
        {visibleIssues.length ? <><DataTable minWidth={850}><thead><tr><th>심각도</th><th>코드</th><th>시트 / 행</th><th>필드</th><th>원본 값</th><th>메시지</th><th>상세</th></tr></thead><tbody>{visibleIssues.map(issue => <tr key={issue.id}><td><StatusBadge status={issue.severity} /></td><td className="mono">{issue.code}</td><td>{source(issue.sourceSheet, issue.sourceRow)}</td><td>{issue.fieldPath ?? '—'}</td><td className="import-observed">{String(issue.observedValue ?? '—')}</td><td>{issue.message}</td><td><button className="button button-small" type="button" onClick={() => setSelectedIssue(issue)}>상세</button></td></tr>)}</tbody></DataTable><div className="import-table-footer"><span>{count(filteredIssues.length)}건 중 {count((issuePage - 1) * PAGE_SIZE + 1)}–{count(Math.min(issuePage * PAGE_SIZE, filteredIssues.length))}건</span><button className="button button-small" disabled={issuePage <= 1} onClick={() => setIssuePage(issuePage - 1)}>이전</button><button className="button button-small" disabled={issuePage * PAGE_SIZE >= filteredIssues.length} onClick={() => setIssuePage(issuePage + 1)}>다음</button></div></> : <EmptyState title="표시할 이슈가 없습니다" description="검색어나 필터를 바꿔 보세요." />}
      </section>
      <section className="panel" aria-label="후보 미리보기"><div className="section-heading"><div><h2>후보 미리보기</h2><p>검증 오류가 있어도 원본에서 추출한 나머지 후보를 살펴볼 수 있습니다.</p></div></div><div className="tabs import-tabs" role="tablist" aria-label="후보 종류">{([['products', 'Products'], ['skus', 'SKUs'], ['bomComponents', 'BOM']] as const).map(([key, label]) => <button key={key} className={`tab ${tab === key ? 'active' : ''}`} role="tab" aria-selected={tab === key} type="button" onClick={() => { setTab(key); setCandidatePage(1) }}>{label} <span>{count(preview[key].length)}</span></button>)}</div>
        {visibleCandidates.length ? <><DataTable minWidth={780}><thead><tr>{tab === 'products' ? <><th>품번</th><th>상품명</th><th>구분 / 카테고리</th><th>원본 위치</th><th>판정</th></> : tab === 'skus' ? <><th>SKU</th><th>모델</th><th>색상</th><th>원본 위치</th><th>판정</th></> : <><th>Product</th><th>구성 SKU</th><th>수량</th><th>원본 위치</th><th>판정</th></>}</tr></thead><tbody>{visibleCandidates.map(item => <tr key={item.id}>{'sabangnetCode' in item ? <><td className="mono">{item.sabangnetCode || '미입력'}</td><td>{item.productName}{item.variantOfSourceRow && <small className="import-variant">원본 {item.variantOfSourceRow}행의 채널 반복</small>}</td><td>{item.productType} · {item.category}</td></> : 'modelName' in item ? <><td className="mono">{item.skuCode}<small className="import-variant">실물 SKU 미승인 후보</small></td><td>{item.modelName}</td><td>{item.color}</td></> : <><td className="mono">{item.productCode || '미입력'}</td><td className="mono">{item.skuCode || item.rawToken}</td><td>{item.quantity ?? '—'}</td></>}<td>{source(item.sourceSheet, item.sourceRow)}</td><td><Status value={item.status} /></td></tr>)}</tbody></DataTable><div className="import-table-footer"><span>{count(filteredCandidates.length)}건 중 {count((candidatePage - 1) * PAGE_SIZE + 1)}–{count(Math.min(candidatePage * PAGE_SIZE, filteredCandidates.length))}건</span><button className="button button-small" disabled={candidatePage <= 1} onClick={() => setCandidatePage(candidatePage - 1)}>이전</button><button className="button button-small" disabled={candidatePage * PAGE_SIZE >= filteredCandidates.length} onClick={() => setCandidatePage(candidatePage + 1)}>다음</button></div></> : <EmptyState title="표시할 후보가 없습니다" description="검색어나 후보 종류를 바꿔 보세요." />}
      </section>
    </>}

    {persistence && <SavedImportReview persistence={persistence} refreshKey={historyRefresh} role={role} />}

    {selectedIssue && preview && <Drawer title={selectedIssue.code} subtitle={source(selectedIssue.sourceSheet, selectedIssue.sourceRow)} onClose={() => setSelectedIssue(null)}><dl className="import-issue-detail"><dt>차단 범위</dt><dd>{selectedIssue.blockingScope}</dd><dt>원본 값</dt><dd>{String(selectedIssue.observedValue ?? '—')}</dd><dt>기대 규칙</dt><dd>{selectedIssue.expectedRule}</dd><dt>설명</dt><dd>{selectedIssue.message}</dd><dt>관련 행</dt><dd>{selectedIssue.relatedRows.length ? selectedIssue.relatedRows.map(row => `${row}행`).join(', ') : '—'}</dd></dl><RelatedCandidates preview={preview} issue={selectedIssue} /><h3 className="import-detail-heading">원본 행</h3>{rawRow ? <dl className="import-raw-cells">{rawRow.rawCells.map(cell => <div key={cell.address}><dt>{cell.address} · {cell.originalType}</dt><dd>{String(cell.originalValue ?? cell.cachedValue ?? '빈 값')}{cell.formulaText && <small>수식: {cell.formulaText}</small>}{cell.errorCode && <small>오류: {cell.errorCode}</small>}</dd></div>)}</dl> : <p className="muted">이 이슈는 파일 구조 전체에 관한 것입니다.</p>}</Drawer>}
  </div>
}
