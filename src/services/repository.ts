import type { IssueStatus, SellerData } from '../types/domain'
/** UI depends on this contract; persistence implementations own serialization and transactions. */
export interface SellerRepository {
  load(): Promise<SellerData>
  mapOffer(offerId: string, productId: string): Promise<SellerData>
  updateIssueStatus(issueId: string, status: IssueStatus): Promise<SellerData>
}
