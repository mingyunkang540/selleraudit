import type { IssueType } from '../types/domain'
export const issueLabels: Record<IssueType, string> = { UNMATCHED: '미매칭', PRICE_MISMATCH: '가격 이상', MISSING_CHANNEL: '채널 누락', INACTIVE_MISMATCH: '판매상태 오류', DUPLICATE: '중복 등록', NEW_LISTING: '신규 상품', CHANGED_LISTING: '정보 변경', MISSING_BOM: '구성 누락' }
export function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(value))
}
