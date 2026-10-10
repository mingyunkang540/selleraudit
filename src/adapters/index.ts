import type { ChannelCode } from '../types/domain'

/** Boundary for future source-specific adapters. V0.1 deliberately defines no parser. */
export interface SourceAdapter<TSource, TNormalized> {
  readonly channel: ChannelCode
  normalize(source: TSource): TNormalized
}
