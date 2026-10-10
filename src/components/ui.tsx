import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Channel, IssueType } from '../types/domain'
import { Icon } from './Icon'

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 tabIndex={-1}>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</header>
}
export function SearchInput({ value, onChange, placeholder = '상품명, 품번, SKU로 검색', label = '검색' }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  return <label className="search-input"><Icon name="search" size={17} /><span className="sr-only">{label}</span><input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>
}
export function SelectField({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: { value: string; label: string }[] }) {
  return <label className="select-field"><span className="sr-only">{label}</span><select value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
}
export function FilterBar({ children }: { children: ReactNode }) { return <div className="filter-bar">{children}</div> }
export function DataTable({ children, minWidth = 680 }: { children: ReactNode; minWidth?: number }) { return <div className="table-scroll"><table className="data-table" style={{ minWidth }}>{children}</table></div> }
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="search" size={25} /></div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>
}
const statusMap: Record<string, [string, string]> = {
  ACTIVE: ['판매중', 'green'], INACTIVE: ['판매중지', 'gray'], DRAFT: ['초안', 'gray'],
  NORMAL: ['정상', 'green'], MISSING: ['미등록', 'red'], PRICE_MISMATCH: ['가격이상', 'orange'], REVIEW: ['확인필요', 'amber'],
  OPEN: ['미처리', 'red'], IN_PROGRESS: ['확인중', 'blue'], RESOLVED: ['해결완료', 'green'], IGNORED: ['제외', 'gray'],
  ERROR: ['오류', 'red'], WARNING: ['주의', 'orange'], INFO: ['안내', 'blue'], SINGLE: ['단품', 'gray'], SET: ['세트', 'purple'],
}
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [text, color] = statusMap[status] ?? [status, 'gray']
  return <span className={`badge badge-${color}`}><span className="badge-dot" />{label ?? text}</span>
}
const issueLabels: Record<IssueType, string> = { UNMATCHED: '미매칭', PRICE_MISMATCH: '가격 이상', MISSING_CHANNEL: '채널 누락', INACTIVE_MISMATCH: '판매상태 오류', DUPLICATE: '중복 등록', NEW_LISTING: '신규 상품', CHANGED_LISTING: '정보 변경', MISSING_BOM: '구성 누락' }
export function IssueBadge({ type }: { type: IssueType }) { return <span className={`issue-badge issue-${type.toLowerCase()}`}>{issueLabels[type]}</span> }
const channelStyles: Record<string, { label: string; color: string }> = { NAVER: { label: 'N', color: '#03c75a' }, COUPANG: { label: 'C', color: '#ed4d46' }, GMARKET: { label: 'G', color: '#0aab79' }, OHOUSE: { label: 'H', color: '#32b9df' }, '11ST': { label: '11', color: '#e83860' }, SSG: { label: 'S', color: '#b33979' } }
export function ChannelBadge({ channel, compact = false }: { channel: Channel; compact?: boolean }) {
  const item = channelStyles[channel.channelCode] ?? { label: channel.channelCode[0], color: '#758099' }
  return <span className="channel-badge" title={channel.channelName}><span className="channel-logo" style={{ background: item.color }}>{item.label}</span>{!compact && <span>{channel.channelName}</span>}{compact && <span className="sr-only">{channel.channelName}</span>}</span>
}
export function ProductThumb({ name, size = 38 }: { name: string; size?: number }) {
  const color = /아쿠아/.test(name) ? '#69b9d9' : /그레이/.test(name) ? '#a9b1bc' : /핑크/.test(name) ? '#e9a1b9' : /그린/.test(name) ? '#79b5a0' : /화이트/.test(name) ? '#bac5d0' : /옐로|레몬/.test(name) ? '#e5c66f' : '#a79acb'
  return <span className="product-thumb" style={{ '--product-color': color, width: size, height: size } as CSSProperties}><svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true"><path d="M11 16h27l-2 23c-.2 2-2 3-4 3H17c-2 0-4-1-4-3z" fill={color} opacity=".6" /><path d="M11 16h27l-2 23c-.2 2-2 3-4 3H17c-2 0-4-1-4-3z" fill="none" stroke={color} /><rect x="9" y="12" width="31" height="6" rx="2.5" fill={color} /><path d="m15 20 1 17 M19 20l.5 17" stroke="white" strokeWidth="1.4" opacity=".65" /><path d="M13 10h24" stroke={color} strokeWidth="2" /><rect x="23" y="23" width="8" height="9" rx="2" fill="white" opacity=".7" /></svg></span>
}
export function Pagination({ page, total, pageSize = 10, onChange }: { page: number; total: number; pageSize?: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="pagination"><span>총 <strong>{total.toLocaleString()}</strong>개 중 {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}개</span><nav aria-label="페이지 이동"><button className="page-button" aria-label="이전 페이지" disabled={page <= 1} onClick={() => onChange(page - 1)}><Icon name="chevronLeft" size={15} /></button>{Array.from({ length: pages }, (_, i) => i + 1).filter(n => pages < 8 || n === 1 || n === pages || Math.abs(n - page) <= 1).map(n => <button className={`page-button ${n === page ? 'selected' : ''}`} key={n} onClick={() => onChange(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>)}<button className="page-button" aria-label="다음 페이지" disabled={page >= pages} onClick={() => onChange(page + 1)}><Icon name="chevron" size={15} /></button></nav><span>{pageSize}개씩 보기</span></div>
}
export function Drawer({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => { const dialog = ref.current; const previous = document.activeElement as HTMLElement | null; dialog?.showModal(); return () => { dialog?.close(); previous?.focus() } }, [])
  return <dialog className="drawer" ref={ref} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right) onClose() } }}><div className="drawer-heading"><div><p className="eyebrow">상세 정보</p><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="닫기" onClick={onClose}><Icon name="close" /></button></div><div className="drawer-body">{children}</div></dialog>
}
export function ConfirmDialog({ title, description, children, onClose, onConfirm, busy = false }: { title: string; description?: string; children?: ReactNode; onClose: () => void; onConfirm: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => { const dialog = ref.current; const previous = document.activeElement as HTMLElement | null; dialog?.showModal(); return () => { dialog?.close(); previous?.focus() } }, [])
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose() }}><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}{children}<div className="dialog-actions"><button className="button" onClick={onClose} disabled={busy}>취소</button><button className="button button-primary" onClick={onConfirm} disabled={busy}>{busy ? '저장 중…' : '연결 확인'}</button></div></dialog>
}
export function KpiCard({ label, value, icon, detail, href, accent = 'blue' }: { label: string; value: number; icon: ReactNode; detail: string; href: string; accent?: string }) {
  return <a className={`kpi-card kpi-${accent}`} href={href}><div className="kpi-top"><span>{label}</span><span className="kpi-icon">{icon}</span></div><strong className="kpi-value">{value.toLocaleString()}</strong><div className="kpi-bottom"><span>{detail}</span><Icon name="arrow" size={16} /></div></a>
}
