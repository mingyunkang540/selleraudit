import type { CellStatus } from '../../types/domain'

export function priceStatus(sale:number|null, normal:number|null, lowerBound:number|null):CellStatus {
  if (sale === null || (normal !== null && lowerBound !== null && lowerBound > normal)) return 'REVIEW'
  if ((normal !== null && sale > normal) || (lowerBound !== null && sale < lowerBound)) return 'PRICE_MISMATCH'
  if (normal === null || lowerBound === null) return 'REVIEW'
  return 'NORMAL'
}
