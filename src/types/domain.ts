export type EntityStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT'
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'IGNORED'
export type IssueType = 'UNMATCHED' | 'PRICE_MISMATCH' | 'MISSING_CHANNEL' | 'INACTIVE_MISMATCH' | 'DUPLICATE' | 'NEW_LISTING' | 'CHANGED_LISTING' | 'MISSING_BOM'
export type Severity = 'INFO' | 'WARNING' | 'ERROR'
export type ChannelCode = string & { readonly __brand: 'ChannelCode' }
export function asChannelCode(value: string): ChannelCode {
  if (!value.trim()) throw new Error('Channel code must not be blank.')
  return value as ChannelCode
}
export interface Workspace { id: string; name: string; createdAt: string; updatedAt: string }
export interface Product { id: string; workspaceId: string; sabangnetCode: string; productName: string; category: string | null; productType: 'SINGLE' | 'SET'; normalPrice: number | null; status: EntityStatus; createdAt: string; updatedAt: string }
export interface Sku { id: string; workspaceId: string; skuCode: string; modelName: string; color: string | null; status: EntityStatus; createdAt: string; updatedAt: string }
export interface ProductComponent { id: string; workspaceId: string; productId: string; skuId: string; quantity: number; createdAt: string }
export interface Channel { id: string; workspaceId: string; channelCode: ChannelCode; channelName: string; status: EntityStatus; createdAt: string }
export interface ChannelListing { id: string; workspaceId: string; channelId: string; channelProductId: string; productName: string; status: EntityStatus; productUrl: string | null; lastSyncedAt: string | null; createdAt: string; updatedAt: string }
export interface ChannelOffer { id: string; workspaceId: string; listingId: string; channelOptionId: string; optionName: string | null; sellerCode: string | null; normalPrice: number | null; salePrice: number | null; status: EntityStatus; masterProductId: string | null; createdAt: string; updatedAt: string }
export interface Alias { id: string; workspaceId: string; rawProductName: string; rawOptionName: string | null; sourceChannel: ChannelCode | null; masterProductId: string; createdAt: string }
export interface AuditIssue { id: string; workspaceId: string; issueType: IssueType; severity: Severity; productId: string | null; channelId: string | null; listingId: string | null; offerId: string | null; title: string; description: string; status: IssueStatus; detectedAt: string; resolvedAt: string | null }
export interface SellerData { workspace: Workspace; products: Product[]; skus: Sku[]; components: ProductComponent[]; channels: Channel[]; listings: ChannelListing[]; offers: ChannelOffer[]; aliases: Alias[]; issues: AuditIssue[] }
export interface OfferDetail { offer: ChannelOffer; listing: ChannelListing; channel: Channel }
export type CellStatus = 'NORMAL' | 'MISSING' | 'PRICE_MISMATCH' | 'REVIEW'
export interface MappingCandidate { productId: string; confidence: number }
